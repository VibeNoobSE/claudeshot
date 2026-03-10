registerGame("gravity-flip", "🔄 Gravity Flip", "SPACE = P1 flip, ENTER = P2 flip", "Avoid obstacles by flipping gravity!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.p1=this.add.rectangle(150,H/2-30,16,20,0xf7c948);this.p2=this.add.rectangle(150,H/2+30,16,20,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true).setGravityY(400);p.setData("grav",1);});
    this.obstacles=this.physics.add.group();
    this.input.keyboard.on("keydown-SPACE",()=>{const g=this.p1.getData("grav")*-1;this.p1.setData("grav",g);this.p1.body.setGravityY(400*g);this.p1.body.setVelocityY(0);});
    this.input.keyboard.on("keydown-ENTER",()=>{const g=this.p2.getData("grav")*-1;this.p2.setData("grav",g);this.p2.body.setGravityY(400*g);this.p2.body.setVelocityY(0);});
    this.physics.add.overlap(this.p1,this.obstacles,()=>{if(!this.over){this.over=true;this.physics.pause();this.add.text(W/2,H/2,"P2 WINS! (P1 hit obstacle)",{fontSize:"28px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);}});
    this.physics.add.overlap(this.p2,this.obstacles,()=>{if(!this.over){this.over=true;this.physics.pause();this.add.text(W/2,H/2,"P1 WINS! (P2 hit obstacle)",{fontSize:"28px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);}});
    this.score=0;this.over=false;
    this.sTxt=this.add.text(W/2,16,"Survived: 0",{fontSize:"16px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.time.addEvent({delay:1200,callback:()=>this.spawnObs(),loop:true});
  }
  spawnObs(){if(this.over)return;this.score++;this.sTxt.setText("Survived: "+this.score);
    const gap=140,gy=Phaser.Math.Between(60,H-60-gap);
    [this.add.rectangle(W+20,gy/2,30,gy,0x555577),this.add.rectangle(W+20,gy+gap+(H-gy-gap)/2,30,H-gy-gap,0x555577)]
      .forEach(o=>{this.obstacles.add(o);this.physics.add.existing(o);o.body.setVelocityX(-200).setImmovable(true).setAllowGravity(false);this.time.delayedCall(5000,()=>o.destroy());});
  }
  update(){}
});
