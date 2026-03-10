registerGame("pac-chase", "👻 Pac Chase", "WASD = Pac, Arrows = Ghost", "Pac eats dots, Ghost hunts Pac!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#0a0a2e");
    this.dots=this.physics.add.group();this.dotsLeft=0;
    for(let x=40;x<W;x+=40)for(let y=40;y<H;y+=40){
      if(Math.random()<0.6){this.dots.add(this.add.circle(x,y,4,0xf7c948));this.dotsLeft++;}
    }
    this.dots.getChildren().forEach(d=>this.physics.add.existing(d,true));
    this.pac=this.add.circle(80,H/2,14,0xf7c948);this.ghost=this.add.circle(W-80,H/2,14,0xe94560);
    [this.pac,this.ghost].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true);});
    this.physics.add.overlap(this.pac,this.dots,(p,d)=>{d.destroy();this.dotsLeft--;this.sTxt.setText("Dots: "+this.dotsLeft);
      if(this.dotsLeft<=0){this.over=true;this.add.text(W/2,H/2,"PAC WINS!",{fontSize:"40px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);}});
    this.physics.add.overlap(this.pac,this.ghost,()=>{if(!this.over){this.over=true;this.add.text(W/2,H/2,"GHOST WINS!",{fontSize:"40px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);}});
    this.sTxt=this.add.text(W/2,16,"Dots: "+this.dotsLeft,{fontSize:"16px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.over=false;
  }
  update(){if(this.over)return;const k=this.k;
    this.pac.body.setVelocity(k.a.isDown?-200:k.d.isDown?200:0,k.w.isDown?-200:k.s.isDown?200:0);
    this.ghost.body.setVelocity(k.left.isDown?-180:k.right.isDown?180:0,k.up.isDown?-180:k.down.isDown?180:0);
  }
});
