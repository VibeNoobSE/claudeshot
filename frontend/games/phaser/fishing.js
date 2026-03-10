registerGame("fishing", "🎣 Fishing Derby", "SPACE = P1 cast/reel, ENTER = P2 cast/reel", "Catch the biggest fish!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a3a5e");
    this.add.rectangle(W/2,H*0.4,W,H*0.8,0x1a2a4e); // water
    this.add.rectangle(W/2,10,W,20,0x4ecca3); // sky line
    this.fish=[];
    for(let i=0;i<12;i++){const size=Phaser.Math.Between(8,24),x=Phaser.Math.Between(50,W-50),y=Phaser.Math.Between(100,H-40);
      const f=this.add.ellipse(x,y,size*2,size,0xccaa44+Phaser.Math.Between(0,0x222222));this.physics.add.existing(f);
      f.body.setVelocityX(Phaser.Math.Between(-60,60)).setBounce(1).setCollideWorldBounds(true);f.setData("size",size);this.fish.push(f);}
    this.p1={x:W/4,casting:false,line:null,score:0};this.p2={x:W*3/4,casting:false,line:null,score:0};
    this.add.circle(this.p1.x,20,8,0xf7c948);this.add.circle(this.p2.x,20,8,0xe94560);
    this.sTxt=this.add.text(W/2,H-20,"P1: 0 | P2: 0",{fontSize:"18px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.gfx=this.add.graphics();
    this.input.keyboard.on("keydown-SPACE",()=>this.cast(this.p1,0xf7c948,"P1"));
    this.input.keyboard.on("keydown-ENTER",()=>this.cast(this.p2,0xe94560,"P2"));
  }
  cast(p,color,label){
    if(p.casting)return;p.casting=true;
    const hookX=p.x+Phaser.Math.Between(-80,80),hookY=Phaser.Math.Between(80,H-40);
    const hook=this.add.circle(hookX,hookY,5,color);
    this.time.delayedCall(1500,()=>{
      let caught=null,bestD=30;
      this.fish.forEach(f=>{if(!f.active)return;const d=Phaser.Math.Distance.Between(hookX,hookY,f.x,f.y);if(d<bestD){bestD=d;caught=f;}});
      if(caught){p.score+=caught.getData("size");caught.destroy();this.sTxt.setText("P1: "+this.p1.score+" | P2: "+this.p2.score);}
      hook.destroy();p.casting=false;
      if(this.fish.filter(f=>f.active).length===0){this.add.text(W/2,H/2,(this.p1.score>this.p2.score?"P1":"P2")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
    });
  }
  update(){this.gfx.clear();
    if(this.p1.casting){}if(this.p2.casting){}
    this.fish.forEach(f=>{if(f.active&&(f.x<10||f.x>W-10))f.body.setVelocityX(-f.body.velocity.x);});
  }
});
